import json

try:
    with open('google-10000-english-usa-no-swears.txt', 'r') as f:
        words = [line.strip().upper() for line in f if line.strip()]
    
    js_content = f"const DICTIONARY = {json.dumps(words)};"
    
    with open('dictionary.js', 'w') as f:
        f.write(js_content)
    print("Successfully created dictionary.js")
except Exception as e:
    print(f"Error: {e}")
