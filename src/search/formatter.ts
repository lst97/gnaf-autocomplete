/** Flat type code → short display prefix */
const FLAT_TYPE_DISPLAY: Record<string, string> = {
  UNIT: "U",
  APT: "APT",
  FLAT: "F",
  SHOP: "SH",
  SE: "STE",
  VLLA: "VILLA",
  TNHS: "TH",
  CARS: "CARPARK",
  STR: "STRATA",
  FCTY: "FACTORY",
  HSE: "HOUSE",
  DUPL: "DUPLEX",
  ROOM: "RM",
  SHED: "SHED",
  KSK: "KIOSK",
  BTSD: "BOATSHED",
  WHSE: "WHSE",
  CTGE: "CTGE",
  MBTH: "MB",
  STLL: "STALL",
  LOT: "LOT",
  BLDG: "BLDG",
  BLCK: "BLOCK",
  GRGE: "GARAGE",
  BNGW: "BUNGALOW",
  MSNT: "MAISONETTE",
  PTHS: "PH",
  STU: "STUDIO",
  REAR: "REAR",
  SEC: "SEC",
  WARD: "WARD",
  ATM: "ATM",
  COOL: "COOLROOM",
  LBBY: "LOBBY",
  LOFT: "LOFT",
  OFFC: "OFFICE",
  RESV: "RESERVE",
  STOR: "STORE",
  WKSH: "WORKSHOP",
  ANT: "ANTENNA",
  BBQ: "BARBECUE",
  CARP: "CARPARK",
  CLUB: "CLUB",
  HALL: "HALL",
  LSE: "LEASE",
  SHRM: "SHOWROOM",
  SIGN: "SIGN",
  SITE: "SITE",
  TNCY: "TENANCY",
  TWR: "TOWER",
  VLT: "VAULT",
  RTCE: "ROOF TCE",
};

/** Street type code → abbreviation (most common types only; raw code shown if no mapping) */
const STREET_TYPE_ABBREV: Record<string, string> = {
  ROAD: "RD",
  STREET: "ST",
  COURT: "CT",
  AVENUE: "AV",
  LANE: "LN",
  PLACE: "PL",
  DRIVE: "DR",
  CLOSE: "CL",
  CRESCENT: "CR",
  TERRACE: "TCE",
  CIRCUIT: "CCT",
  PARADE: "PDE",
  GROVE: "GR",
  WALK: "WK",
  BOULEVARD: "BV",
  TRAIL: "TRL",
  HIGHWAY: "HWY",
  TRACK: "TK",
  ACCESS: "ACCS",
  PARKWAY: "PKWY",
  ESPlANADE: "ESP",
  PROMENADE: "PROM",
  SQUARE: "SQ",
  RISE: "RISE",
  ROW: "ROW",
  WAY: "WAY",
  CIRCLE: "CIR",
  GLEN: "GLN",
  LOOP: "LOOP",
};

export interface AddressComponents {
  buildingName?: string | null;
  lotNumberPrefix?: string | null;
  lotNumber?: string | null;
  lotNumberSuffix?: string | null;
  flatTypeCode?: string | null;
  flatNumber?: number | null;
  flatNumberPrefix?: string | null;
  flatNumberSuffix?: string | null;
  levelTypeCode?: string | null;
  levelNumber?: number | null;
  levelNumberPrefix?: string | null;
  levelNumberSuffix?: string | null;
  numberFirst?: number | null;
  numberFirstPrefix?: string | null;
  numberFirstSuffix?: string | null;
  numberLast?: number | null;
  numberLastPrefix?: string | null;
  numberLastSuffix?: string | null;
  streetName?: string | null;
  streetTypeCode?: string | null;
  streetSuffixCode?: string | null;
  localityName: string;
  stateAbbreviation: string;
  postcode: string;
}

function formatOptionalNum(val: number | null | undefined): string {
  if (val == null) return "";
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}

export function buildDisplay(c: AddressComponents): string {
  // Prefix parts (building, lot, flat, level) — joined with ", " if multiple
  const prefixParts: string[] = [];

  if (c.buildingName) prefixParts.push(c.buildingName);
  if (c.lotNumber) {
    prefixParts.push(`Lot ${c.lotNumberPrefix ?? ""}${c.lotNumber}${c.lotNumberSuffix ?? ""}`);
  }
  if (c.flatTypeCode && c.flatNumber != null) {
    const prefix = FLAT_TYPE_DISPLAY[c.flatTypeCode] ?? c.flatTypeCode;
    let num = formatOptionalNum(c.flatNumber);
    if (c.flatNumberPrefix) num = c.flatNumberPrefix + num;
    if (c.flatNumberSuffix) num = num + c.flatNumberSuffix;
    prefixParts.push(`${prefix} ${num}`);
  }
  if (c.levelTypeCode && c.levelNumber != null) {
    let num = formatOptionalNum(c.levelNumber);
    if (c.levelNumberPrefix) num = c.levelNumberPrefix + num;
    if (c.levelNumberSuffix) num = num + c.levelNumberSuffix;
    prefixParts.push(`${c.levelTypeCode} ${num}`);
  }

  // Street line: "59 MAIN STREET" (number + name merged, no comma between them)
  let streetLine = "";
  if (c.numberFirst != null) {
    let num = formatOptionalNum(c.numberFirst);
    if (c.numberFirstPrefix) num = c.numberFirstPrefix + num;
    if (c.numberFirstSuffix) num = num + c.numberFirstSuffix;
    if (c.numberLast != null) {
      let last = formatOptionalNum(c.numberLast);
      if (c.numberLastPrefix) last = c.numberLastPrefix + last;
      if (c.numberLastSuffix) last = last + c.numberLastSuffix;
      num = `${num}-${last}`;
    }
    streetLine = num;
  }
  if (c.streetName) {
    if (streetLine) streetLine += " ";
    streetLine += c.streetName;
    if (c.streetTypeCode) {
      streetLine += ` ${STREET_TYPE_ABBREV[c.streetTypeCode] ?? c.streetTypeCode}`;
    }
    if (c.streetSuffixCode) {
      streetLine += ` ${c.streetSuffixCode}`;
    }
  }

  // Locality line
  const localityLine = `${c.localityName} ${c.stateAbbreviation} ${c.postcode}`;

  // Assemble: [prefix1, prefix2, ...] + streetLine + localityLine
  const allParts = [...prefixParts];
  if (streetLine) allParts.push(streetLine);
  allParts.push(localityLine);

  return allParts.join(", ");
}

/** Build lowercased search text for trigram/FTS indexing */
export function buildSearchText(display: string): string {
  return display.toLowerCase();
}
