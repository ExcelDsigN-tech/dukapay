import { Router } from 'express';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import {
  getAgentDashboard,
  clearAgentDashboardCache,
} from '../controllers/agentDashboardController.js';

const router = Router();

/**
 * @swagger
 * /agents/dashboard:
 *   get:
 *     summary: Get agent dashboard metrics
 *     tags: [Agent]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Agent dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentDashboard'
 */
router.get('/dashboard', requireJwtAuth, getAgentDashboard);

/**
 * @swagger
 * /agents/dashboard/cache:
 *   delete:
 *     summary: Clear agent dashboard cache
 *     tags: [Agent]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared
 */
router.delete('/dashboard/cache', requireJwtAuth, clearAgentDashboardCache);

export default router;
