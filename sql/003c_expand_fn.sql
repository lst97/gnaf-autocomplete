-- G-NAF Address Autocomplete: Abbreviation expansion function.
-- Replaces known abbreviations in text with their full forms.
-- Used by the MV's search_text_expanded column for improved trigram matching.
--
-- Usage: SELECT expand_address_abbrevs('MAIN ST');
-- Returns: 'MAIN STREET'

CREATE OR REPLACE FUNCTION expand_address_abbrevs(input_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
    word        TEXT;
    expanded    TEXT := '';
    full_form   TEXT;
BEGIN
    IF input_text IS NULL OR input_text = '' THEN
        RETURN input_text;
    END IF;

    -- Tokenize by whitespace and expand each word
    FOR word IN SELECT unnest(string_to_array(input_text, ' '))
    LOOP
        IF expanded != '' THEN
            expanded := expanded || ' ';
        END IF;

        -- Try to find an expansion for this word
        SELECT am.full_form INTO full_form
        FROM public.address_abbrev_map am
        WHERE am.abbrev = upper(word);

        IF full_form IS NOT NULL THEN
            expanded := expanded || full_form;
        ELSE
            expanded := expanded || word;
        END IF;
    END LOOP;

    RETURN expanded;
END;
$$;
