"""
Lists every real model your Gemini API key can actually access, straight
from Google's servers — run this instead of guessing model names.

Usage:
    python scripts/list_available_models.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from google import genai

key = os.environ.get("GEMINI_API_KEY")
if not key:
    print("GEMINI_API_KEY not found in your .env file.")
    sys.exit(1)

client = genai.Client(api_key=key)

print("Real models available to your API key:\n")
try:
    for model in client.models.list():
        name = getattr(model, "name", str(model))
        actions = getattr(model, "supported_actions", None)
        if actions is None:
            # SDK attribute name may differ by version — show everything rather than guess wrong
            print(f"  {name}  |  full info: {model}")
        elif "generateContent" in actions:
            print(f"  {name}")
except Exception as e:
    print(f"Listing failed: {e}")
    print("\nIf this itself errors, your key or project may not have the")
    print("Generative Language API enabled yet — check in Google AI Studio.")

print("\nCopy one of the names above (without the leading 'models/') into")
print("MODEL_CANDIDATES in app/core/llm_client.py.")
