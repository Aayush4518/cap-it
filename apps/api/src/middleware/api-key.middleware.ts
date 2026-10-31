import type { RequestHandler } from "express";

export function requireApiKey(apiKeys: ReadonlyMap<string, string>): RequestHandler{
    return (req, res, next)=>{
        const apiKey = req.get("x-api-key")
        const clientId = apiKey? apiKeys.get(apiKey): undefined

        if(clientId === undefined){
            res.status(401).json({error: "unauthorized"})
            return
        }

        //store identity for later middleware

        res.locals.clientId = clientId
        next();
    }
}