import json

try:
    with open('words_alpha.txt', 'r') as f:
        # Filter for words with 4+ letters to save space/memory if needed, 
        # but user said "all 4 letter or more words", so we filter.
        words = [line.strip().upper() for line in f if len(line.strip()) >= 4]
    
    js_content = f"const VALIDATION_DICT = new Set({json.dumps(words)});"
    
    with open('all_words.js', 'w') as f:
        f.write(js_content)
    print(f"Successfully created all_words.js with {len(words)} words.")
except Exception as e:
    print(f"Error: {e}")
