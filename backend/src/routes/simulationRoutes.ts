import { Router } from 'express';
import {
  getRemittanceHistory,
  simulatePayment,
  simulateTransaction,
} from '../controllers/simulationController.js';
import { validate } from '../middleware/validation.js';
import {
  getRemittanceHistorySchema,
  simulatePaymentSchema,
  simulateTransactionSchema,
} from '../schemas/simulationSchemas.js';
import { simulationRateLimiter } from '../middleware/rateLimiter.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import { requireTenantAccess } from '../middleware/rbac.js';

const router = Router();

/**
 * @swagger
 * /history/{userId}:
 *   get:
 *     summary: Get remittance history for a user
 *     description: Retrieve the remittance history for the authenticated user. The userId path parameter must match the JWT wallet (or an assigned borrower for agents).
 *     tags: [Simulation]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully retrieved remittance history.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RemittanceHistory'
 *       401:
 *         description: Missing or invalid authentication.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Authenticated wallet does not match userId.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found or no remittance history available.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

router.get(
  '/history/:userId',
  simulationRateLimiter,
  requireJwtAuth,
  requireTenantAccess,
  validate(getRemittanceHistorySchema),
  getRemittanceHistory,
);

/**
 * @swagger
 * /simulate:
 *   post:
 *     summary: Simulate a remittance payment
 *     description: Simulate a remittance payment for the authenticated user and return the projected score change.
 *     tags: [Simulation]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Amount to simulate remittance for.
 *             required:
 *               - amount
 *     responses:
 *       200:
 *         description: Simulation successful.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimulatePaymentResponse'
 *       400:
 *         description: Invalid input data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid authentication.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/simulate',
  simulationRateLimiter,
  requireJwtAuth,
  validate(simulatePaymentSchema),
  simulatePayment,
);

/**
 * @swagger
 * /simulate/transaction:
 *   post:
 *     summary: Simulate a Soroban transaction (dry-run)
 *     description: |
 *       Pre-execution validation: dry-runs a Soroban contract call, returns gas
 *       estimation, predicted return value, failure reason (if any), and warnings.
 *       Simulations are cached for 30 seconds.
 *     tags: [Simulation]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractId
 *               - function
 *               - sourceAccount
 *             properties:
 *               contractId:
 *                 type: string
 *                 description: Stellar contract address to simulate against
 *               function:
 *                 type: string
 *                 description: Contract function name to invoke
 *               args:
 *                 type: array
 *                 description: Function arguments (type + value pairs)
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [address, u32, i32, u64, i64, u128, i128, bool, string, symbol, bytes, bytesN, option, void]
 *                     value:
 *                       description: Argument value
 *               sourceAccount:
 *                 type: string
 *                 description: Account to simulate from (must be a valid Stellar public key)
 *     responses:
 *       200:
 *         description: Simulation result with gas estimate and return value
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 gasEstimate:
 *                   type: string
 *                 returnValue:
 *                   description: Decoded return value (if any)
 *                 error:
 *                   type: string
 *                   description: Error message (if simulation failed)
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                 balanceDeltas:
 *                   type: array
 *                   items:
 *                     type: object
 *                 cached:
 *                   type: boolean
 *                 simulatedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Missing or invalid authentication
 */
router.post(
  '/simulate/transaction',
  simulationRateLimiter,
  requireJwtAuth,
  validate(simulateTransactionSchema),
  simulateTransaction,
);

export default router;
