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

## Rows

The `checks` cases are whole rows, checked by `SheetValidator` here and by `Tabula::checkRows()`
on the server, which is sent them. Both must find the same issues: the row, the field, the code,
the other rows an issue points at, and the params a case lists.

The server is sent values in the form the grid writes them, never in the user's own writing: a
number as decimal text with a point, a date as ISO 8601, a yes/no as a boolean, a lookup as its
id. Text a host loaded, such as "1.234,56" in a money column, goes as what the grid reads it to,
and the grid holds it to the rules as that value. Text the grid could not read goes as it stands,
so the server refuses it for the same reason. A case's `sent` lists the values that go in another
form than the grid holds them, and the test here fails if one is missing.

The PHP runner skips these cases against a nouxwell/tabula checkout without `RowChecker`.

## Dates

Both sides read a date the same way, in this order: the field's pattern, an Excel serial number
written as digits, the other pattern (date and time for a date field, and the other way round),
and ISO 8601 without an offset. Nothing else is guessed. A date that does not exist, such as
31.02.2026, is refused rather than rolled into March, and "05/03/2026" with Turkish settings is
refused rather than read as 3 May.

Before 0.9.0, nouxwell/tabula fell back on PHP's free-form date reader, which accepted all of
those without an error. Against an older checkout, the cases for them fail.
