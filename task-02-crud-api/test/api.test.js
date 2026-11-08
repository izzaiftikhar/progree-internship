const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.CORS_ORIGINS = 'https://trusted.example';

const app = require('../src/app');
const pool = require('../src/db');

test('REST API integration tests', async () => {
  const server = app.listen(0);
  let categoryId;
  let productId;

  try {
    await new Promise((resolve) => server.once('listening', resolve));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function request(path, options = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });

      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
        headers: response.headers,
      };
    }

    // Health check
    let result = await request('/health');
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'ok');

    // Allowed CORS origin
    result = await request('/health', {
      headers: { Origin: 'https://trusted.example' },
    });
    assert.equal(result.status, 200);
    assert.equal(
      result.headers.get('access-control-allow-origin'),
      'https://trusted.example'
    );

    // Unapproved CORS origin
    result = await request('/health', {
      headers: { Origin: 'https://untrusted.example' },
    });
    assert.equal(result.status, 200);
    assert.equal(
      result.headers.get('access-control-allow-origin'),
      null
    );

    const categoryName = `API Test ${Date.now()} ${process.pid}`;

    // Create category
    result = await request('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name: categoryName }),
    });
    assert.equal(result.status, 201);
    categoryId = result.body.id;

    // Read category
    result = await request(`/api/categories/${categoryId}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.name, categoryName);

    // Update category
    result = await request(`/api/categories/${categoryId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: `${categoryName} Updated` }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.name, `${categoryName} Updated`);

    // Duplicate category
    result = await request('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name: `${categoryName} Updated` }),
    });
    assert.equal(result.status, 409);

    // Create product
    result = await request('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        name: 'API Test Laptop',
        description: 'Temporary integration test product',
        price: 50000,
        stock: 5,
        category_id: categoryId,
      }),
    });
    assert.equal(result.status, 201);
    productId = result.body.id;

    // Read product
    result = await request(`/api/products/${productId}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.category_name, `${categoryName} Updated`);

    // List products
    result = await request('/api/products?search=API%20Test%20Laptop');
    assert.equal(result.status, 200);
    assert.ok(result.body.data.some((item) => item.id === productId));

    // Update product
    result = await request(`/api/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify({ price: 55000, stock: 8 }),
    });
    assert.equal(result.status, 200);
    assert.equal(Number(result.body.price), 55000);
    assert.equal(result.body.stock, 8);

    // Invalid product data
    result = await request('/api/products', {
      method: 'POST',
      body: JSON.stringify({ name: 'A', price: -100, stock: -5 }),
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Validation failed');

    // Non-existent category reference
    result = await request('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Invalid Category Product',
        price: 100,
        category_id: 999999999,
      }),
    });
    assert.equal(result.status, 400);

    // Delete product
    const deletedProductId = productId;
    result = await request(`/api/products/${deletedProductId}`, {
      method: 'DELETE',
    });
    assert.equal(result.status, 204);
    productId = null;

    // Verify product deletion
    result = await request(`/api/products/${deletedProductId}`);
    assert.equal(result.status, 404);

    // Delete category
    result = await request(`/api/categories/${categoryId}`, {
      method: 'DELETE',
    });
    assert.equal(result.status, 204);
    const deletedCategoryId = categoryId;
    categoryId = null;

    // Verify category deletion
    result = await request(`/api/categories/${deletedCategoryId}`);
    assert.equal(result.status, 404);

    console.log('All API integration and CORS checks passed.');
    } finally {
    if (productId) {
      await pool.query('DELETE FROM products WHERE id = $1', [productId]);
    }

    if (categoryId) {
      await pool.query('DELETE FROM categories WHERE id = $1', [categoryId]);
    }

    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });

    await pool.end();
  }
});