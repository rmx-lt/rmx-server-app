import { db } from "./db";
import type { AppEnumValue, AppEnumGroup } from "@/data/local/serviceTypes";

export async function getEnumGroup(enumGroup: AppEnumGroup): Promise<AppEnumValue[]> {
    return db.table("appEnumSetup").where("enumGroup").equals(enumGroup).toArray();
}

export async function getAllAppEnums(): Promise<AppEnumValue[]> {
    return db.table("appEnumSetup").toArray();
}
