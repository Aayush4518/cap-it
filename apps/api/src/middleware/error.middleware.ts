import type { ErrorRequestHandler } from "express";
// import { error } from "node:console";


export const errorMiddleware: ErrorRequestHandler = (
    error, _req, res, next
)=>{
    if(res.headersSent){
        next(error)
        return
    }
    
    const requestId = res.locals.requestId;
    const errorCode = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (errorCode === "cors_origin_not_allowed") {
        res.status(403).json({ error: "origin_not_allowed", requestId });
        return;
    }

    const candidateStatus = typeof error === "object" && error !== null
        ? (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode
        : undefined;
    const status = typeof candidateStatus === "number" && candidateStatus >= 400 && candidateStatus < 500
        ? candidateStatus
        : 500;
    if (status >= 500) {
        console.error("Unhandled request error", {
            requestId,
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
    }
    const code = status === 413 ? "request_too_large" : status === 400 ? "invalid_request" : "internal_server_error";
    res.status(status).json({ error: code, requestId });
}
