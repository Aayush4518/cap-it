import { Router } from "express";

export const demoRouter = Router()

demoRouter.get("/", (_req, res)=>{
    res.status(200).json({message:"Request accepted", endpoint:"demo"})
})