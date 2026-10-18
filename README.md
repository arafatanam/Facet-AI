# Facet AI

## Stack
Next.js 16 App Router, React 18, Supabase (Auth, Postgres, Storage), Groq vision, Stripe.

## Functionality
- Consumer-facing web app for photo-based appearance feedback and personal improvement planning.
- Analyzes front and side photos and returns feature scores, practical recommendations, and progress reports.
- Uses private, browser-specific guest sessions; photos and scan history are not shared between visitors.
- Provides coaching, user profiles, and Stripe subscriptions. Guest data is not recoverable if browser data is cleared or on another device.

## Availability
https://facet-ai.vercel.app/

## Development
```sh
npm ci
npm run dev
npm run build
npm start
```
