import type { ErrorRequestHandler } from "express";
// import { error } from "node:console";


export const errorMiddleware: ErrorRequestHandler = (
    error, _req, res, next
)=>{
    if(res.headersSent){
        next(error)
        return
    }
    
    const requestId = res.locals.requestId
    console.error("Unhandled request error", {requestId, error})
    res.status(500).json({
        error:"internal_server_error", requestId
    })   
}