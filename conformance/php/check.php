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
 */

use Nouxwell\Tabula\Exception\ParseException;
use Nouxwell\Tabula\Format;
use Nouxwell\Tabula\Port\PassthroughTranslator;
use Nouxwell\Tabula\Schema\Field;
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

function field(array $given): Field
{
    $field = match ($given['type']) {
        'string' => Field::string('f'),
        'integer' => Field::integer('f'),
        'decimal' => Field::decimal('f'),
        'quantity' => Field::quantity('f'),
        'money' => Field::money('f')->currency($given['currency'] ?? null),
        'bool' => Field::bool('f'),
        'date' => Field::date('f'),
        'datetime' => Field::dateTime('f'),
        'options' => Field::options('f', array_combine(
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

    return $field;
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

printf("%d cases, %d failed\n", $checked, $failures);
exit(0 === $failures ? 0 : 1);
