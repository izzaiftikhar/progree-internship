const router = require('express').Router();
const { body, param } = require('express-validator');
const pool = require('../db');
const validate = require('../middleware/validate');
const { AppError, wrap } = require('../middleware/errors');

const id = param('id').isInt({ min: 1 }).withMessage('id must be a positive integer').toInt();
const nameRule = body('name').isString().trim().isLength({ min: 2, max: 100 }).withMessage('name must be 2-100 characters');

router.get('/', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM categories ORDER BY id');
  res.json(rows);
}));

router.get('/:id', id, validate, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM categories WHERE id=$1', [req.params.id]);
  if (!rows[0]) throw new AppError(404, 'Category not found');
  res.json(rows[0]);
}));

router.post('/', nameRule, validate, wrap(async (req, res) => {
  const { rows } = await pool.query('INSERT INTO categories(name) VALUES($1) RETURNING *', [req.body.name]);
  res.status(201).json(rows[0]);
}));

router.put('/:id', id, nameRule, validate, wrap(async (req, res) => {
  const { rows } = await pool.query('UPDATE categories SET name=$1 WHERE id=$2 RETURNING *', [req.body.name, req.params.id]);
  if (!rows[0]) throw new AppError(404, 'Category not found');
  res.json(rows[0]);
}));

router.delete('/:id', id, validate, wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM categories WHERE id=$1', [req.params.id]);
  if (!rowCount) throw new AppError(404, 'Category not found');
  res.status(204).end();
}));

module.exports = router;
