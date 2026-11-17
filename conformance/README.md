# Conformance

The browser and the server must agree about every cell. A price typed as "1.234,56" in the grid
has to mean what nouxwell/tabula would make of the same text in an imported file, or the backend
checks a different number from the one the user saw.

[values.json](values.json) holds the cases: text in, value out, and value in, text out, under
Turkish and English settings. Both sides run the same file.

```bash
# @nouxwell/tabula-core
corepack pnpm --filter @nouxwell/tabula-core test

# nouxwell/tabula 0.9.0 or later, from a checkout with its Composer dependencies installed
php conformance/php/check.php /path/to/tabula
```

A case marked `"php": false` uses something only this side has: percentages, lookups, and fields
that hold several options.

## Dates

Both sides read a date the same way, in this order: the field's pattern, an Excel serial number
written as digits, the other pattern (date and time for a date field, and the other way round),
and ISO 8601 without an offset. Nothing else is guessed. A date that does not exist, such as
31.02.2026, is refused rather than rolled into March, and "05/03/2026" with Turkish settings is
refused rather than read as 3 May.

Before 0.9.0, nouxwell/tabula fell back on PHP's free-form date reader, which accepted all of
those without an error. Against an older checkout, the cases for them fail.
