// for AdonisJS v6
import path from "node:path";
import url from "node:url";
import { buildSocketEventsMarkdown } from "../app/docs/socket_events.js";
// ---

const apiDescription = [
    "REST API for the Chat App.",
    "",
    "The server also exposes a real-time layer over Socket.IO that is not",
    "part of the OpenAPI spec proper. See the section below for the list of",
    "events, their payloads and the rooms they target.",
    "",
    buildSocketEventsMarkdown(),
].join("\n");

export default {
    // path: __dirname + "/../", for AdonisJS v5
    path: path.dirname(url.fileURLToPath(import.meta.url)) + "/../", // for AdonisJS v6
    title: "Chat App API", // use info instead
    version: "1.0.0", // use info instead
    description: apiDescription, // use info instead
    tagIndex: 3,
    productionEnv: "production", // optional
    info: {
        title: "Chat App API",
        version: "1.0.0",
        description: apiDescription,
    },
    snakeCase: true,

    debug: false, // set to true, to get some useful debug output
    ignore: ["/swagger", "/docs"],
    preferredPutPatch: "PUT", // if PUT/PATCH are provided for the same route, prefer PUT
    common: {
        parameters: {}, // OpenAPI conform parameters that are commonly used
        headers: {}, // OpenAPI conform headers that are commonly used
    },
    securitySchemes: {
        BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Paste the JWT access token returned by /auth/login.",
        },
    },
    authMiddlewares: ["auth", "auth:api"], // routes using these middleware names get BearerAuth applied
    defaultSecurityScheme: "BearerAuth", // optional
    persistAuthorization: true, // persist authorization between reloads on the swagger page
    showFullPath: true, // the path displayed after endpoint summary
};