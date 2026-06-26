/**
 * api/rules.js — Vercel Serverless Function
 * GET /api/rules  — returns the current static rule set
 */
import { getStaticRules } from './lib/rules.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const rules = getStaticRules();
  return res.status(200).json({ rule_count: rules.length, rules });
}
