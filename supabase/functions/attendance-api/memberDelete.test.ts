import { assertEquals } from "jsr:@std/assert";
import { deleteMembersKeepingAttendance } from "./memberDelete.ts";

Deno.test("멤버 삭제는 members만 지워서 기존 출석 행을 그대로 남긴다", async () => {
  const state: {
    members: { id: string }[];
    attendance: { id: number; member_id: string | null; name: string }[];
  } = {
    members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    attendance: [
      { id: 1, member_id: "m1", name: "김호연" },
      { id: 2, member_id: "m2", name: "이하늘" },
    ],
  };
  const touched: string[] = [];
  const fakeDb = {
    from(table: string) {
      touched.push(table);
      return {
        delete() {
          return {
            in(column: string, ids: string[]) {
              state.members = state.members.filter((row) => !ids.includes(row.id));
              state.attendance = state.attendance.map((row) =>
                ids.includes(row.member_id ?? "") ? { ...row, member_id: null } : row
              );
              return Promise.resolve({ error: null, column });
            },
          };
        },
      };
    },
  };

  await deleteMembersKeepingAttendance(fakeDb, ["m1", "m2"]);

  assertEquals(state.members, [{ id: "m3" }]);
  assertEquals(state.attendance, [
    { id: 1, member_id: null, name: "김호연" },
    { id: 2, member_id: null, name: "이하늘" },
  ]);
  assertEquals(touched, ["members"]);
});
