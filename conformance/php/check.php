<?php

declare(strict_types=1);

/*
 * Runs conformance/values.json through nouxwell/tabula's own parsers and formatters.
 *
 *     php conformance/php/check.php /path/to/a/tabula/checkout
 *
 * The checkout needs its Composer dependencies installed. Every case @nouxwell/tabula-core passes
 * should pass here too; a case that does not is a place where the two sides would disagree about
 * the same cell. Exit code 0 when every case passes.
 *
 * The "checks" cases are rows as the grid sends them, run through Tabula's RowChecker (what
 * Tabula::checkRows() runs); a checkout from before it skips them.
 */

use Nouxwell\Tabula\Exception\ParseException;
use Nouxwell\Tabula\Format;
use Nouxwell\Tabula\Grid\GridIssue;
use Nouxwell\Tabula\Grid\GridSchema;
use Nouxwell\Tabula\Grid\RowChecker;
use Nouxwell\Tabula\Grid\Rule;
use Nouxwell\Tabula\Port\PassthroughTranslator;
use Nouxwell\Tabula\Schema\Field;
use Nouxwell\Tabula\Schema\Schema;
use Nouxwell\Tabula\Settings\DateSettings;
use Nouxwell\Tabula\Settings\NumberSettings;
use Nouxwell\Tabula\Settings\SymbolPosition;
use Nouxwell\Tabula\Settings\TabulaSettings;
use Nouxwell\Tabula\Value\FormatContext;
use Nouxwell\Tabula\Value\FormatterRegistry;
use Nouxwell\Tabula\Value\ParseContext;
use Nouxwell\Tabula\Value\ParserRegistry;

$tabula = $argv[1] ?? null;

if (null === $tabula || !is_file($tabula.'/vendor/autoload.php')) {
    fwrite(STDERR, "Usage: php check.php /path/to/a/tabula/checkout (with vendor/ installed)\n");
    exit(2);
}

require $tabula.'/vendor/autoload.php';

$cases = json_decode((string) file_get_contents(__DIR__.'/../values.json'), true, flags: JSON_THROW_ON_ERROR);

function settings(array $given): TabulaSettings
{
    return new TabulaSettings(
        numbers: new NumberSettings(
            decimalSeparator: $given['decimalSeparator'],
            thousandSeparator: $given['thousandSeparator'],
            currencySymbols: $given['currencySymbols'],
            symbolPosition: SymbolPosition::from($given['symbolPosition']),
        ),
        dates: new DateSettings(datePattern: $given['datePattern'], dateTimePattern: $given['dateTimePattern']),
        boolTrueKey: $given['trueWord'],
        boolFalseKey: $given['falseWord'],
    );
}

function field(array $given, string $key = 'f'): Field
{
    $field = match ($given['type']) {
        'string' => Field::string($key),
        // A lookup's own type does not matter: GridSchema::lookup() makes the field a record's id.
        'integer', 'lookup' => Field::integer($key),
        'decimal' => Field::decimal($key),
        'quantity' => Field::quantity($key),
        'money' => Field::money($key)->currency($given['currency'] ?? null),
        'bool' => Field::bool($key),
        'date' => Field::date($key),
        'datetime' => Field::dateTime($key),
        'options' => Field::options($key, array_combine(
            array_map(static fn (array $option) => $option['value'], $given['options']),
            array_map(static fn (array $option) => $option['label'], $given['options']),
        )),
    };

    if (isset($given['decimals'])) {
        $field = $field->decimals($given['decimals']);
    }

    if (isset($given['pattern'])) {
        $field = $field->pattern($given['pattern']);
    }

    if ($given['required'] ?? false) {
        $field = $field->required();
    }

    return $field;
}

/** The grid's fields as a GridSchema says them: lookups, rules, what is read-only and not sent. */
function grid(array $fields): GridSchema
{
    $grid = GridSchema::of(Schema::make('conformance')->fields(...array_map(
        static fn (array $given): Field => field($given, $given['key']),
        $fields,
    )), 1);

    foreach ($fields as $given) {
        if (isset($given['lookup'])) {
            $grid = $grid->lookup($given['key'], $given['lookup']);
        }

        if (isset($given['rules'])) {
            $grid = $grid->rules($given['key'], ...array_map(static fn (array $rule): Rule => match ($rule['rule']) {
                'min' => Rule::min($rule['value']),
                'max' => Rule::max($rule['value']),
                'minLength' => Rule::minLength($rule['value']),
                'maxLength' => Rule::maxLength($rule['value']),
                'unique' => Rule::unique(),
            }, $given['rules']));
        }

        if (false === ($given['editable'] ?? true)) {
            $grid = $grid->readOnly($given['key']);
        }

        if (false === ($given['submit'] ?? true)) {
            $grid = $grid->notSubmitted($given['key']);
        }
    }

    return $grid;
}

/**
 * The rows as the grid sends them: a value from "sent" where the case gives one, and a lookup as
 * its id, or as {label} when it holds text never matched to a record (SheetSession's lookupPayload).
 */
function sentRows(array $fields, array $case): array
{
    $lookups = array_column(array_filter($fields, static fn (array $given): bool => 'lookup' === $given['type']), 'key');
    $sent = array_column($case['sent'] ?? [], 'values', 'rowId');

    return array_map(static function (array $row) use ($lookups, $sent): array {
        $values = [...$row['values'], ...($sent[$row['rowId']] ?? [])];

        foreach ($lookups as $key) {
            if (isset($values[$key])) {
                $values[$key] = is_array($values[$key]) ? $values[$key]['id'] : ['label' => $values[$key]];
            }
        }

        return ['rowId' => $row['rowId'], 'values' => $values];
    }, $case['rows']);
}

/** An issue as far as a case says what it should be: the params it lists, the message if it gives one. */
function asExpected(array $issue, ?array $expected): array
{
    $shape = ['rowId' => $issue['rowId'], 'field' => $issue['field'], 'code' => $issue['code'], 'targets' => $issue['targets'] ?? []];

    if (isset($expected['params'])) {
        $shape['params'] = [];

        foreach (array_keys($expected['params']) as $key) {
            $shape['params'][$key] = $issue['params'][$key] ?? null;
        }
    }

    if (isset($expected['message'])) {
        $shape['message'] = $issue['message'];
    }

    return $shape;
}

/** A parsed value written the way the JSON writes it: numbers as decimal text, dates as ISO. */
function canonical(mixed $value, string $type): mixed
{
    if ($value instanceof DateTimeInterface) {
        return $value->format('datetime' === $type ? 'Y-m-d\TH:i:s' : 'Y-m-d');
    }

    if (is_int($value) && 'options' !== $type) {
        return (string) $value;
    }

    if (is_float($value)) {
        $text = rtrim(rtrim(sprintf('%.10F', $value), '0'), '.');

        return '-0' === $text ? '0' : $text;
    }

    return $value;
}

$failures = 0;
$checked = 0;
$parsers = ParserRegistry::default();
$formatters = FormatterRegistry::default();
$translator = new PassthroughTranslator();

foreach ($cases['read'] as $case) {
    if (false === ($case['php'] ?? true)) {
        continue;
    }

    ++$checked;
    $field = field($case['field']);
    $context = new ParseContext('tr', $translator, settings($cases['settings'][$case['settings']]));

    try {
        $got = canonical($parsers->for($field)->parse($case['input'], $field, $context), $case['field']['type']);
        $problem = null;
    } catch (ParseException $exception) {
        $got = null;
        $problem = $exception->rowErrorCode()?->value;
    }

    $ok = array_key_exists('problem', $case)
        ? $problem === $case['problem']
        : null === $problem && $got === $case['value'];

    if (!$ok) {
        ++$failures;
        printf(
            "read   %-24s %-10s expected %s, got %s\n",
            json_encode($case['input'], JSON_UNESCAPED_UNICODE),
            $case['field']['type'],
            json_encode($case['problem'] ?? $case['value'], JSON_UNESCAPED_UNICODE),
            json_encode($problem ?? $got, JSON_UNESCAPED_UNICODE),
        );
    }
}

foreach ($cases['format'] as $case) {
    ++$checked;
    $field = field($case['field']);
    $context = new FormatContext('tr', $translator, settings($cases['settings'][$case['settings']]), Format::Csv);
    $text = $formatters->for($field->getType())->format($case['value'], $field, [], $context)->text;

    if ($text !== $case['text']) {
        ++$failures;
        printf(
            "format %-24s %-10s expected %s, got %s\n",
            json_encode($case['value'], JSON_UNESCAPED_UNICODE),
            $case['field']['type'],
            json_encode($case['text'], JSON_UNESCAPED_UNICODE),
            json_encode($text, JSON_UNESCAPED_UNICODE),
        );
    }
}

if (!class_exists(RowChecker::class)) {
    echo "checks skipped: this checkout has no RowChecker\n";
} else {
    $grid = grid($cases['checks']['fields']);

    foreach ($cases['checks']['cases'] as $case) {
        ++$checked;
        $issues = (new RowChecker())->check($grid, sentRows($cases['checks']['fields'], $case));
        $got = [];

        foreach ($issues as $index => $issue) {
            $got[] = asExpected($issue->toArray(), $case['issues'][$index] ?? null);
        }

        $want = array_map(static fn (array $issue): array => asExpected($issue, $issue), $case['issues']);

        if ($got !== $want) {
            ++$failures;
            printf(
                "check  %s\n       expected %s\n       got      %s\n",
                $case['about'],
                json_encode($want, JSON_UNESCAPED_UNICODE),
                json_encode($got, JSON_UNESCAPED_UNICODE),
            );
        }
    }
}

printf("%d cases, %d failed\n", $checked, $failures);
exit(0 === $failures ? 0 : 1);
