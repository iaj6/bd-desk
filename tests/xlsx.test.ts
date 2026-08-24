import { describe, it, expect } from "vitest";
import { crc32 as nodeCrc32 } from "node:zlib";
import { workbook } from "../crm/lib/xlsx.ts";

// crm/lib/xlsx.ts hand-rolls both the zip container and the OOXML parts. The failure
// mode that matters is a container Excel silently refuses to open — a wrong central
// directory offset, a bad CRC, a length field that disagrees with the payload. So
// these tests parse the bytes back with an independent reader (offsets read from the
// spec, CRCs checked against node's zlib) rather than trusting the writer's own math.

interface Entry { name: string; data: Buffer }

// Minimal STORED-only zip reader. Walks the central directory the way a real
// unzipper does: EOCD → central records → local headers → payload.
function unzip(buf: Buffer): Entry[] {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record");

  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  expect(entriesOnDisk).toBe(totalEntries);
  expect(cdOffset + cdSize).toBe(eocd); // central directory must run right up to the EOCD

  const out: Entry[] = [];
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50); // central file header signature
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("ascii");

    expect(buf.readUInt32LE(localOffset)).toBe(0x04034b50); // local file header signature
    expect(buf.readUInt16LE(localOffset + 8)).toBe(0); // method 0 = stored
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);

    expect(compSize).toBe(uncompSize); // stored: the two must agree
    expect(data.length).toBe(uncompSize);
    expect(nodeCrc32(data)).toBe(crc); // independent CRC — catches a bad table or seed
    out.push({ name, data: Buffer.from(data) });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const read = (entries: Entry[], name: string) => {
  const e = entries.find((x) => x.name === name);
  if (!e) throw new Error(`missing zip entry ${name}, have: ${entries.map((x) => x.name).join(", ")}`);
  return e.data.toString("utf8");
};

describe("workbook — zip container", () => {
  it("produces a readable archive with every OOXML part a reader needs", () => {
    const entries = unzip(workbook([{ name: "Targets", rows: [["a"], ["b"]] }]));
    expect(entries.map((e) => e.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("keeps local-header offsets correct across multiple sheets", () => {
    // The offset accumulator in zip() is the classic place a hand-rolled writer
    // drifts: every entry after the first depends on every prior length being right.
    const entries = unzip(
      workbook([
        { name: "Targets", rows: [["one"]] },
        { name: "People", rows: [["two"]] },
        { name: "Third", rows: [["three"]] },
      ]),
    );
    expect(entries).toHaveLength(7);
    expect(read(entries, "xl/worksheets/sheet2.xml")).toContain(">two<");
    expect(read(entries, "xl/worksheets/sheet3.xml")).toContain(">three<");
  });

  it("stays byte-identical across runs (fixed timestamp, no randomness)", () => {
    const a = workbook([{ name: "Targets", rows: [["x"]] }]);
    const b = workbook([{ name: "Targets", rows: [["x"]] }]);
    expect(a.equals(b)).toBe(true);
  });
});

describe("workbook — sheet contents", () => {
  it("declares one content-type override and one relationship per sheet", () => {
    const entries = unzip(workbook([{ name: "Targets", rows: [] }, { name: "People", rows: [] }]));
    const types = read(entries, "[Content_Types].xml");
    expect(types).toContain("/xl/worksheets/sheet1.xml");
    expect(types).toContain("/xl/worksheets/sheet2.xml");

    const rels = read(entries, "xl/_rels/workbook.xml.rels");
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain('Id="rId2"');

    // Sheet r:id values must match the rels ids, or Excel opens an empty workbook.
    const wb = read(entries, "xl/workbook.xml");
    expect(wb).toContain('name="Targets" sheetId="1" r:id="rId1"');
    expect(wb).toContain('name="People" sheetId="2" r:id="rId2"');
  });

  it("writes cells as inline strings so no value can execute as a formula", () => {
    const entries = unzip(workbook([{ name: "Targets", rows: [["=SUM(A1:A9)", "+1", "@cmd"]] }]));
    const sheet = read(entries, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).not.toContain("<f>"); // never a formula cell
    expect(sheet).toContain(">=SUM(A1:A9)<"); // kept verbatim, as literal text
  });

  it("escapes XML metacharacters in cell values", () => {
    const entries = unzip(workbook([{ name: "Targets", rows: [["Ben & Jerry's <tag>"]] }]));
    const sheet = read(entries, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain("Ben &amp; Jerry's &lt;tag&gt;");
    expect(sheet).not.toContain("<tag>");
  });

  it("strips control characters that would make the XML unparseable", () => {
    // Agent-sourced text can carry stray control bytes; XML 1.0 forbids them outright.
    const entries = unzip(workbook([{ name: "Targets", rows: [["bad\x00\x07value"]] }]));
    expect(read(entries, "xl/worksheets/sheet1.xml")).toContain(">badvalue<");
  });

  it("preserves whitespace and renders null/undefined as empty cells", () => {
    const entries = unzip(workbook([{ name: "Targets", rows: [["  padded  ", null, undefined]] }]));
    const sheet = read(entries, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain('xml:space="preserve"');
    expect(sheet).toContain(">  padded  <");
    expect(sheet.match(/<c t="inlineStr">/g)).toHaveLength(3); // empties still occupy cells
  });

  it("numbers rows from 1", () => {
    const entries = unzip(workbook([{ name: "Targets", rows: [["h"], ["r1"], ["r2"]] }]));
    const sheet = read(entries, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain('<row r="1">');
    expect(sheet).toContain('<row r="3">');
    expect(sheet).not.toContain('<row r="0">');
  });
});
