import { Router } from 'express';
import { listMyTransactions } from '../controllers/transactionController.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';

const router = Router();

/**
 * @swagger
 * /transactions/me:
 *   get:
 *     summary: List the authenticated user's transactions
 *     description: >
 *       Returns a paginated list of transactions for the authenticated
 *       wallet, including the type, amount, currency, counterparty and
 *       on-chain status (or `null` when not yet submitted).
 *     tags: [Transactions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, transactions, page]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     required: [id, type, reference, amount, currency, status, counterparty, createdAt]
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       type:
 *                         type: string
 *                         enum: [deposit, withdrawal, loan, repayment, remittance, yield]
 *                       reference:
 *                         type: string
 *                       amount:
 *                         type: number
 *                       fee:
 *                         type: number
 *                       currency:
 *                         type: string
 *                       status:
 *                         type: string
 *                         nullable: true
 *                       counterparty:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       metadata:
 *                         type: object
 *                         additionalProperties: true
 *                 page:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       401:
 *         description: Missing or invalid Bearer token.
 */
router.get('/me', requireJwtAuth, listMyTransactions);

export default router;
