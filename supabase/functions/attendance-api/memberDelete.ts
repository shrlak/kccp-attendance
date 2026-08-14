export interface MemberDeleteDb {
  from(table: string): {
    delete(): {
      in(column: string, values: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export async function deleteMembersKeepingAttendance(
  db: MemberDeleteDb,
  memberIds: string[],
): Promise<void> {
  if (!memberIds.length) return;
  // devices + member_roles cascade; attendance_log uses ON DELETE SET NULL, so deleting
  // only members keeps every historical attendance row and its denormalized name/date.
  const { error } = await db.from("members").delete().in("id", memberIds);
  if (error) throw new Error(error.message);
}
