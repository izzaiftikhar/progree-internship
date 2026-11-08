const router = require('express').Router();
const { body, param, query } = require('express-validator');
const pool = require('../db');
const validate = require('../middleware/validate');
const { AppError, wrap } = require('../middleware/errors');

const id = param('id').isInt({ min: 1 }).withMessage('id must be a positive integer').toInt();
const fields = (optional) => {
  const o = (c) => (optional ? c.optional() : c);
  return [
    o(body('name')).isString().trim().isLength({ min: 2, max: 150 }).withMessage('name must be 2-150 characters'),
    body('description').optional().isString().isLength({ max: 2000 }),
    o(body('price')).isFloat({ min: 0 }).withMessage('price must be a number >= 0').toFloat(),
    body('stock').optional().isInt({ min: 0 }).withMessage('stock must be an integer >= 0').toInt(),
    body('category_id').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  ];
};

router.get('/', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('category_id').optional().isInt({ min: 1 }).toInt(),
  query('search').optional().isString().trim(),
], validate, wrap(async (req, res) => {
  const page = req.query.page || 1;
  const limit = req.query.limit || 10;
  const where = []; const params = [];
  if (req.query.category_id) { params.push(req.query.category_id); where.push(`category_id=$${params.length}`); }
  if (req.query.search) { params.push(`%${req.query.search}%`); where.push(`name ILIKE $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await pool.query(`SELECT COUNT(*) FROM products ${clause}`, params)).rows[0].count;
  const { rows } = await pool.query(
    `SELECT * FROM products ${clause} ORDER BY id LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params);
  res.json({ page, limit, total: Number(total), data: rows });
}));

router.get('/:id', id, validate, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1`,
    [req.params.id]);
  if (!rows[0]) throw new AppError(404, 'Product not found');
  res.json(rows[0]);
}));

router.post('/', fields(false), validate, wrap(async (req, res) => {
  const { name, description = '', price, stock = 0, category_id = null } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO products(name,description,price,stock,category_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [name, description, price, stock, category_id]);
  res.status(201).json(rows[0]);
}));

router.put('/:id', id, fields(true), validate, wrap(async (req, res) => {
  const allowed = ['name', 'description', 'price', 'stock', 'category_id'];
  const sets = []; const params = [];
  for (const k of allowed) if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) throw new AppError(400, 'No fields to update');
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE products SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`, params);
  if (!rows[0]) throw new AppError(404, 'Product not found');
  res.json(rows[0]);
}));

router.delete('/:id', id, validate, wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
  if (!rowCount) throw new AppError(404, 'Product not found');
  res.status(204).end();
}));

module.exports = router;
