-- G-NAF Address Autocomplete: Abbreviation expansion map.
-- Used by sql/007_expand_fn.sql to expand common abbreviations for trigram matching.
-- "MAIN ST" → "MAIN STREET" catches more trigram matches.

CREATE TABLE IF NOT EXISTS address_abbrev_map (
    abbrev      TEXT NOT NULL PRIMARY KEY,
    full_form   TEXT NOT NULL
);

-- Street type abbreviations (most common first)
INSERT INTO address_abbrev_map (abbrev, full_form) VALUES
    ('ST', 'STREET'),
    ('RD', 'ROAD'),
    ('AV', 'AVENUE'),
    ('AVE', 'AVENUE'),
    ('CT', 'COURT'),
    ('DR', 'DRIVE'),
    ('CR', 'CRESCENT'),
    ('CRES', 'CRESCENT'),
    ('CL', 'CLOSE'),
    ('CCT', 'CIRCUIT'),
    ('TCE', 'TERRACE'),
    ('PD', 'PARADE'),
    ('PDE', 'PARADE'),
    ('GR', 'GROVE'),
    ('PL', 'PLACE'),
    ('LN', 'LANE'),
    ('WK', 'WALK'),
    ('BV', 'BOULEVARD'),
    ('BVD', 'BOULEVARD'),
    ('HWY', 'HIGHWAY'),
    ('ESP', 'ESPLANADE'),
    ('PROM', 'PROMENADE'),
    ('SQ', 'SQUARE'),
    ('CIR', 'CIRCLE'),
    ('PKWY', 'PARKWAY'),
    ('TRL', 'TRAIL'),
    ('TK', 'TRACK'),
    ('ACCS', 'ACCESS'),
    ('GLN', 'GLEN'),
    ('MTWY', 'MOTORWAY'),
    ('FWY', 'FREEWAY'),
    ('EXP', 'EXPRESSWAY'),
    ('BYPA', 'BYPASS')
ON CONFLICT (abbrev) DO NOTHING;

-- Directional suffixes
INSERT INTO address_abbrev_map (abbrev, full_form) VALUES
    ('N', 'NORTH'),
    ('S', 'SOUTH'),
    ('E', 'EAST'),
    ('W', 'WEST'),
    ('NE', 'NORTH EAST'),
    ('NW', 'NORTH WEST'),
    ('SE', 'SOUTH EAST'),
    ('SW', 'SOUTH WEST'),
    ('UPP', 'UPPER'),
    ('LOW', 'LOWER')
ON CONFLICT (abbrev) DO NOTHING;

-- State abbreviations
INSERT INTO address_abbrev_map (abbrev, full_form) VALUES
    ('NSW', 'NEW SOUTH WALES'),
    ('VIC', 'VICTORIA'),
    ('QLD', 'QUEENSLAND'),
    ('WA', 'WESTERN AUSTRALIA'),
    ('SA', 'SOUTH AUSTRALIA'),
    ('TAS', 'TASMANIA'),
    ('ACT', 'AUSTRALIAN CAPITAL TERRITORY'),
    ('NT', 'NORTHERN TERRITORY'),
    ('OT', 'OTHER TERRITORIES')
ON CONFLICT (abbrev) DO NOTHING;

-- Flat/unit type abbreviations
INSERT INTO address_abbrev_map (abbrev, full_form) VALUES
    ('U', 'UNIT'),
    ('APT', 'APARTMENT'),
    ('F', 'FLAT'),
    ('SH', 'SHOP'),
    ('STE', 'SUITE'),
    ('PH', 'PENTHOUSE'),
    ('TH', 'TOWNHOUSE'),
    ('OF', 'OFFICE'),
    ('OFC', 'OFFICE'),
    ('VLLA', 'VILLA'),
    ('TNHS', 'TOWNHOUSE')
ON CONFLICT (abbrev) DO NOTHING;
