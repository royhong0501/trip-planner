import { Router } from 'express';
import { addParticipantSchema } from '@trip-planner/shared-schema';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  addParticipant,
  deleteParticipant,
  listParticipants,
} from '../services/participants.js';

export const participantsRouter = Router();

participantsRouter.get(
  '/trips/:tripId/participants',
  asyncHandler(async (req, res) => {
    const participants = await listParticipants(req.params.tripId as string);
    res.json(participants);
  }),
);

participantsRouter.post(
  '/trips/:tripId/participants',
  requireAdmin,
  validate(addParticipantSchema, 'body'),
  asyncHandler(async (req, res) => {
    const body = req.body as { displayName: string; email?: string | null };
    const participant = await addParticipant(
      req.params.tripId as string,
      body.displayName,
      body.email ?? null,
    );
    res.status(201).json(participant);
  }),
);

participantsRouter.delete(
  '/participants/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteParticipant(req.params.id as string);
    res.status(204).end();
  }),
);
