#!/usr/bin/env python3
import json
import sys
from argostranslate import translate

languages = translate.load_installed_languages()

lang_map = {lang.code: lang for lang in languages}

def get_translation(source_code, target_code):
    source = lang_map.get(source_code)
    target = lang_map.get(target_code)
    if not source or not target:
        return None
    translations = source.get_translations_to(target)
    if not translations:
        return None
    return translations[0]

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        data = json.loads(line)
        text = data.get("text", "")
        source = data.get("source_lang", "en")
        target = data.get("target_lang", "ru")
        translation = get_translation(source, target)
        if not translation:
            sys.stdout.write(json.dumps({"error": "missing_translation"}) + "\n")
            sys.stdout.flush()
            continue
        translated = translation.translate(text)
        sys.stdout.write(json.dumps({"text": translated}) + "\n")
        sys.stdout.flush()
    except Exception as exc:
        sys.stdout.write(json.dumps({"error": str(exc)}) + "\n")
        sys.stdout.flush()
