# Supabase Edge Function: Gemini Chatbot (`gemini-chat`)

This Edge Function powers the Menutech AI Chatbot using the Google Gemini API with multimodal text and image support.

## Environment Variables / Secrets Setup

To deploy and run this function in Supabase, set your Google Gemini API key as a secret:

```bash
supabase secrets set GEMINI_API_KEY="your-gemini-api-key-here"
```

## Deployment Command

To deploy the function to your Supabase project (`eemqyrysdgasfjlitads`):

```bash
supabase functions deploy gemini-chat --no-verify-jwt
```

## API Endpoint Details

- **URL**: `https://eemqyrysdgasfjlitads.supabase.co/functions/v1/gemini-chat`
- **HTTP Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <ANON_KEY>`
- **Body JSON Format**:
  ```json
  {
    "prompt": "Hola, ¿qué servicios ofrecen?",
    "history": [
      { "role": "user", "text": "Hola" },
      { "role": "model", "text": "¡Hola! Soy Menutech Bot, ¿en qué puedo ayudarte?" }
    ],
    "image": {
      "mimeType": "image/png",
      "data": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  }
  ```
- **Response JSON Format**:
  ```json
  {
    "reply": "Ofrecemos menús digitales interactivos, páginas web para restaurantes..."
  }
  ```
