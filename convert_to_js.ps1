$json = Get-Content 'dictionary_compact.json' -Raw
$js = "const WORD_DEFINITIONS = $json;"
Set-Content 'dictionary_compact.js' -Value $js
