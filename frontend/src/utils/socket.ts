import { io } from "socket.io-client";
import { API_ENDPOINT } from "@/config";

const socketOptions: any = {
    autoConnect: true,
    reconnectionDelayMax: 1000,
};

export const socket = io(API_ENDPOINT, socketOptions);