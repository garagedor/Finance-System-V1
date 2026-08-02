import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, getDb } from "@/lib/finance-db";
import { readSession } from "@/lib/rbac";
import type { TaskRecord } from "@/types/finance";
import type { User } from "@/types/user";
import { PageHeader } from "../_components/page-helpers";
import TaskBoard, { type BoardUser } from "./TaskBoard";

export const dynamic = "force-dynamic";

async function loadBoard() {
  await ensureFinanceIndexes();
  const c = await coll<TaskRecord>(FINANCE_COLLECTIONS.task);
  const tasks = await c.find({}).sort({ order: 1, _id: -1 }).limit(1000).toArray();

  // Assignees are login accounts (the management team). Only active users.
  const db = await getDb();
  const rawUsers = await db
    .collection<User>("users")
    .find({ active: { $ne: false } })
    .project({ name: 1, type: 1 })
    .sort({ name: 1 })
    .toArray();
  const users: BoardUser[] = rawUsers.map((u) => ({
    _id: String(u._id),
    name: u.name,
  }));

  return { tasks, users };
}

export default async function TasksPage() {
  const [{ tasks, users }, session] = await Promise.all([loadBoard(), readSession()]);

  const perms = new Set(session?.permissions ?? []);
  const isAdmin = session?.type === "admin";
  const canCreate = isAdmin || perms.has("finance:tasks:create");
  const canEdit = isAdmin || perms.has("finance:tasks:edit");
  const canDelete = isAdmin || perms.has("finance:tasks:delete");

  const open = tasks.filter((t) => t.status !== "done").length;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Team"
        title="Task Board"
        subtitle={
          <>
            {open} open {open === 1 ? "task" : "tasks"} · drag cards between columns to update status
          </>
        }
      />
      <TaskBoard
        initialTasks={tasks}
        users={users}
        me={{ id: session?.userId, name: session?.name ?? "" }}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
