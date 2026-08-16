import assert from "node:assert/strict";
import test from "node:test";
import {
  autocompletePlaces,
  calculateRoute,
  reverseGeocode,
} from "./barikoiService.js";

const withApiKey = async (callback) => {
  const previous = process.env.BARIKOI_API_KEY;
  process.env.BARIKOI_API_KEY = "test-key";
  try {
    await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.BARIKOI_API_KEY;
    } else {
      process.env.BARIKOI_API_KEY = previous;
    }
  }
};

const response = (payload) => async () => ({
  ok: true,
  headers: { get: () => "application/json" },
  json: async () => payload,
});

test("normalizes Barikoi autocomplete results", async () => {
  await withApiKey(async () => {
    const results = await autocompletePlaces("Dhanmondi", response({
      places: [{
        id: 10,
        address: "Dhanmondi 27, Dhaka",
        area: "Dhanmondi",
        city: "Dhaka",
        latitude: "23.756",
        longitude: "90.375",
      }],
    }));
    assert.deepEqual(results[0], {
      id: "10",
      address: "Dhanmondi 27, Dhaka",
      addressBangla: "",
      area: "Dhanmondi",
      city: "Dhaka",
      postCode: "",
      latitude: 23.756,
      longitude: 90.375,
    });
  });
});

test("normalizes reverse-geocode addresses", async () => {
  await withApiKey(async () => {
    const result = await reverseGeocode(23.756, 90.375, response({
      place: {
        address: "Road 27, Dhanmondi, Dhaka",
        area: "Dhanmondi",
        city: "Dhaka",
        latitude: "23.756",
        longitude: "90.375",
      },
    }));
    assert.equal(result.area, "Dhanmondi");
    assert.equal(result.latitude, 23.756);
  });
});

test("normalizes a route response", async () => {
  await withApiKey(async () => {
    const result = await calculateRoute({
      originLatitude: 23.75,
      originLongitude: 90.37,
      destinationLatitude: 23.81,
      destinationLongitude: 90.41,
      profile: "car",
    }, response({
      routes: [{
        distance: 8200,
        duration: 1450,
        geometry: {
          type: "LineString",
          coordinates: [[90.37, 23.75], [90.41, 23.81]],
        },
      }],
    }));
    assert.equal(result.distanceMeters, 8200);
    assert.equal(result.durationSeconds, 1450);
    assert.equal(result.geometry.type, "LineString");
  });
});
