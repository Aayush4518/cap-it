import { createApp } from "./app";

const port= Number(process.env.PORT??  3000) 
const apiKey = process.env.CAPIT_API_KEY
if(!apiKey) throw new Error("CAPIT_API_KEY must be set")


const app = createApp(new Map([[apiKey, "local-client"]]))

app.listen(port, ()=>{
    console.log(`API listening on port ${port}`)

})