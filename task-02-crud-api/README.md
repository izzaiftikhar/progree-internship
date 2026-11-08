# Task 2 - Secured RESTful CRUD API

A REST API built with Node.js, Express.js and PostgreSQL.

## Features

- Category CRUD operations
- Product CRUD operations
- Relational database with foreign keys
- Product search and pagination
- Input validation
- Parameterized SQL queries
- Centralized error handling
- HTTP status codes
- Helmet security headers
- Configurable CORS allowlist
- Rate limiting
- JSON request body size limit
- Automated integration tests

## Technology Stack

- Node.js
- Express.js
- PostgreSQL
- node-postgres (pg)
- express-validator
- Helmet
- CORS
- express-rate-limit
- Node.js built-in test runner

## Requirements

- Node.js and npm
- PostgreSQL

## Installation

1. Install dependencies:

   npm install

2. Create your environment file:

   Copy-Item .env.example .env

3. Configure DATABASE_URL in .env with your PostgreSQL credentials.

4. Create the PostgreSQL database named progree if it does not already exist.

5. Apply the database schema:

   npm run migrate

6. Start the API:

   npm start

For development:

   npm run dev

The API runs at http://localhost:3000 by default.

## Environment Variables

| Variable | Description |
|---|---|
| PORT | API server port |
| DATABASE_URL | PostgreSQL connection string |
| CORS_ORIGINS | Comma-separated list of permitted browser origins |

Example CORS configuration:

   CORS_ORIGINS=http://localhost:5173

Leave CORS_ORIGINS empty if no cross-origin browser frontend is required.

## API Endpoints

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | /health | API health check |

### Categories

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/categories | List categories |
| GET | /api/categories/:id | Get category |
| POST | /api/categories | Create category |
| PUT | /api/categories/:id | Update category |
| DELETE | /api/categories/:id | Delete category |

### Products

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/products | List products |
| GET | /api/products/:id | Get product |
| POST | /api/products | Create product |
| PUT | /api/products/:id | Update product |
| DELETE | /api/products/:id | Delete product |

Product listing supports:

- page
- limit
- search
- category_id

Example:

   GET /api/products?page=1&limit=10&search=laptop

## Example Requests

Create a category:

   POST /api/categories

   {
     "name": "Electronics"
   }

Create a product:

   POST /api/products

   {
     "name": "Laptop",
     "description": "Development laptop",
     "price": 1200,
     "stock": 5,
     "category_id": 1
   }

## HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | Successful request |
| 201 | Resource created |
| 204 | Resource deleted |
| 400 | Invalid request or data |
| 404 | Resource not found |
| 409 | Duplicate resource |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

## Security

- Helmet provides HTTP security headers.
- CORS uses an explicit origin allowlist.
- Rate limiting restricts excessive requests.
- JSON request bodies are limited to 10 KB.
- Express-validator checks incoming data.
- Parameterized SQL queries help prevent SQL injection.
- Centralized error handling avoids exposing internal server errors.
- Environment variables keep database credentials outside source code.

## Automated Tests

Run:

   npm test

Integration tests cover:

- API health check
- Category CRUD
- Product CRUD
- Product search
- Invalid input
- Duplicate category handling
- Invalid category references
- Resource deletion and 404 responses

## Project Structure

   src/
     middleware/
     routes/
     app.js
     db.js
     migrate.js
     schema.sql
     server.js

   test/
     api.test.js

   .env.example
   .gitignore
   package.json
   README.md
