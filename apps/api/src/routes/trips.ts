import { Router } from 'express';
import { createTripSchema, updateTripListsSchema, updateTripSchema } from '@trip-planner/shared-schema';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import {
  createTripRecord,
  deleteTripRecord,
  getTripById,
  listTrips,
  updateTripLists,
  updateTripRecord,
} from '../services/trips.js';
import { cancelRemindersForTrip } from '../queue/reminderQueue.js';

export const tripsRouter = Router();

// Public: list + get (legacy behavior — the old Supabase RLS had public-select).
tripsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const trips = await listTrips();
    res.json(trips);
  }),
);

tripsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const trip = await getTripById(req.params.id as string);
    if (!trip) {
      res.status(404).json(null);
      return;
    }
    res.json(trip);
  }),
);

// Write endpoints: admin only.
tripsRouter.post(
  '/',
  requireAdmin,
  validate(createTripSchema, 'body'),
  asyncHandler(async (req, res) => {
    const trip = await createTripRecord(req.body as Parameters<typeof createTripRecord>[0]);
    res.status(201).json(trip);
  }),
);

tripsRouter.patch(
  '/:id',
  requireAdmin,
  validate(updateTripSchema, 'body'),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    if (!id) throw HttpError.badRequest('missing :id');
    const trip = await updateTripRecord(id, req.body as Parameters<typeof updateTripRecord>[1]);
    res.json(trip);
  }),
);

tripsRouter.patch(
  '/:id/lists',
  requireAdmin,
  validate(updateTripListsSchema, 'body'),
  asyncHandler(async (req, res) => {
    const body = req.body as { luggageList: Parameters<typeof updateTripLists>[1]; shoppingList: Parameters<typeof updateTripLists>[2] };
    await updateTripLists(req.params.id as string, body.luggageList, body.shoppingList);
    res.status(204).end();
  }),
);

tripsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    await deleteTripRecord(id);
    await cancelRemindersForTrip(id).catch((err) => {
      console.error('[deleteTrip] cancel reminders failed', err);
    });
    res.status(204).end();
  }),
);
