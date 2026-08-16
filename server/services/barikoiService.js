import { ApiError } from "../errors/ApiError.js";

const DEFAULT_BASE_URL = "https://barikoi.xyz";
const REQUEST_TIMEOUT_MS = 12_000;

const configuration = () => {
  const apiKey = String(process.env.BARIKOI_API_KEY || "").trim();
  if (!apiKey) {
    throw new ApiError(
      503,
      "MAP_PROVIDER_UNAVAILABLE",
      "The Bangladesh map service has not been configured.",
    );
  }
  return {
    apiKey,
    baseUrl: String(
      process.env.BARIKOI_API_BASE_URL || DEFAULT_BASE_URL,
    ).replace(/\/$/, ""),
  };
};

const requestBarikoi = async (path, parameters, fetcher = fetch) => {
  const { apiKey, baseUrl } = configuration();
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError(
      502,
      "MAP_PROVIDER_ERROR",
      "The map provider could not be reached.",
      { details: error.message },
    );
  }

  const contentType = response.headers?.get?.("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(
      502,
      "MAP_PROVIDER_ERROR",
      "The map provider returned an unexpected response.",
    );
  }
  const payload = await response.json().catch(() => {
    throw new ApiError(
      502,
      "MAP_PROVIDER_ERROR",
      "The map provider returned invalid data.",
    );
  });
  if (!response.ok || Number(payload.status || response.status) >= 400) {
    const status = response.status === 429 ? 429 : 502;
    throw new ApiError(
      status,
      response.status === 429
        ? "MAP_RATE_LIMITED"
        : "MAP_PROVIDER_ERROR",
      response.status === 429
        ? "The map request limit has been reached. Try again shortly."
        : "The map provider could not complete this request.",
      { details: payload.message || payload.error || payload.status },
    );
  }
  return payload;
};

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const placeCoordinates = (place = {}) => ({
  latitude: number(place.latitude ?? place.lat ?? place.geo_location?.[1]),
  longitude: number(
    place.longitude ?? place.lng ?? place.lon ?? place.geo_location?.[0],
  ),
});

export const autocompletePlaces = async (query, fetcher) => {
  const payload = await requestBarikoi(
    "/v2/api/search/autocomplete/place",
    {
      q: query,
      city: "dhaka",
      sub_area: true,
      sub_district: true,
      country_code: "bd",
    },
    fetcher,
  );
  return (payload.places || [])
    .map((place) => ({
      id: String(place.id || place.uCode || place.address || ""),
      address: place.address || place.Address || "",
      addressBangla: place.address_bn || "",
      area: place.area || place.sub_area || "",
      city: place.city || "Dhaka",
      postCode: String(place.postCode || place.postcode || ""),
      ...placeCoordinates(place),
    }))
    .filter(
      (place) =>
        place.address &&
        place.latitude !== null &&
        place.longitude !== null,
    )
    .slice(0, 8);
};

export const reverseGeocode = async (latitude, longitude, fetcher) => {
  const payload = await requestBarikoi(
    "/v2/api/search/reverse/geocode",
    {
      latitude,
      longitude,
      address: true,
      area: true,
      post_code: true,
      sub_district: true,
      thana: true,
      country_code: "bd",
    },
    fetcher,
  );
  const place = payload.place || {};
  return {
    address: place.address || "",
    addressBangla: place.address_bn || "",
    area: place.area || place.sub_area || "",
    city: place.city || "Dhaka",
    postCode: String(place.postCode || place.postcode || ""),
    thana: place.thana || place.sub_district || "",
    latitude,
    longitude,
  };
};

export const calculateRoute = async ({
  originLatitude,
  originLongitude,
  destinationLatitude,
  destinationLongitude,
  profile = "car",
}, fetcher) => {
  const coordinates =
    `${originLongitude},${originLatitude};` +
    `${destinationLongitude},${destinationLatitude}`;
  const payload = await requestBarikoi(
    `/v2/api/route/${coordinates}`,
    { geometries: "geojson", profile },
    fetcher,
  );
  const route = payload.routes?.[0];
  if (!route) {
    throw new ApiError(
      404,
      "ROUTE_NOT_FOUND",
      "No route was found between these locations.",
    );
  }
  return {
    distanceMeters: number(route.distance) || 0,
    durationSeconds: number(route.duration) || 0,
    geometry: route.geometry || null,
    waypoints: payload.waypoints || [],
  };
};
