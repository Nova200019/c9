import { Request, Response, NextFunction } from "express";
import env from "../enviroment/env";
import authFullUser from "./authFullUser";

const authAdmin = async (req: Request, res: Response, next: NextFunction) => {
  await authFullUser(req as any, res, async (error?: unknown) => {
    if (error) {
      return next(error as any);
    }

    const user = (req as any).user;
    const adminEmail = process.env.ADMIN_EMAIL;

    if (!user || (!user.admin && (!adminEmail || user.email !== adminEmail))) {
      return res.status(403).send("Admin access required");
    }

    next();
  });
};

export default authAdmin;
