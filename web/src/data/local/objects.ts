import type { Table } from "dexie";
import { db } from "./db";
import type { Object, Environment } from "@/data/local/schemaTypes";

const objectsTable: Table<Object, [number, number]> = db.table("objects");

export async function getObject(obj: Object): Promise<Object | undefined> {
    return objectsTable.get([obj.id, obj.environmentId]);
}

export async function getObjectsByEnvironment(env: Environment): Promise<Object[]> {
    return objectsTable.where("environmentId").equals(env.id).toArray();
}

export async function saveObject(obj: Object): Promise<void> {
    await objectsTable.put(obj);
}

export async function saveObjects(objects: Object[]): Promise<void> {
    await objectsTable.bulkPut(objects);
}

export async function deleteObject(obj: Object): Promise<void> {
    await objectsTable.delete([obj.id, obj.environmentId]);
}

export async function deleteObjectsByEnvironment(env: Environment): Promise<void> {
    await objectsTable.where("environmentId").equals(env.id).delete();
}
