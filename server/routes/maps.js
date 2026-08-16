import { Router } from "express";
import { validationError } from "../errors/ApiError.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  autocompletePlaces,
  calculateRoute,
  reverseGeocode,
} from "../services/barikoiService.js";

const router = Router();
router.use(authenticate);

const coordinate = (value, field, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw validationError("Correct the map coordinates.", {
      [field]: `${field} must be between ${min} and ${max}.`,
    });
  }
  return parsed;
};

const bangladeshCoordinates = (latitude, longitude) => ({
  latitude: coordinate(latitude, "latitude", 20.5, 26.8),
  longitude: coordinate(longitude, "longitude", 88, 92.8),
});

router.get("/autocomplete", async (request, response, next) => {
  try {
    const query = String(request.query.q || "").trim();
    if (query.length < 3 || query.length > 120) {
      return next(validationError("Enter at least three address characters.", {
        q: "Use between 3 and 120 characters.",
      }));
    }
    return response.json({ data: await autocompletePlaces(query) });
  } catch (error) {
    return next(error);
  }
});

router.get("/reverse-geocode", async (request, response, next) => {
  try {
    const location = bangladeshCoordinates(
      request.query.latitude,
      request.query.longitude,
    );
    return response.json({
      data: await reverseGeocode(location.latitude, location.longitude),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/route", async (request, response, next) => {
  try {
    const origin = bangladeshCoordinates(
      request.query.originLatitude,
      request.query.originLongitude,
    );
    const destination = bangladeshCoordinates(
      request.query.destinationLatitude,
      request.query.destinationLongitude,
    );
    const profile = String(request.query.profile || "car");
    if (!["car", "foot"].includes(profile)) {
      return next(validationError("Select a supported route profile.", {
        profile: "Use car or foot.",
      }));
    }
    return response.json({
      data: await calculateRoute({
        originLatitude: origin.latitude,
        originLongitude: origin.longitude,
        destinationLatitude: destination.latitude,
        destinationLongitude: destination.longitude,
        profile,
      }),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
