// The rules table this build's 3D fight runs on: fight.gd rules_id() (app/game3d/tests/judge_test.gd pins the
// same string, and a jest test checks the two agree). Sent with /v1/duel/start (fight3d_rules) so the server
// sets the fight up, and later judges it, on this table. The server keeps every table in testers' hands:
// builds 19 to 21 send nothing and stay on "f3d-1-21d2cde61ab2"; build 22 added SHOOT and RAIN, so its table
// and id are new. Deploy the server before an app whose id it does not know (docs/game3d/XP.md).
export const FIGHT3D_RULES = "f3d-2-e872f23a43a5";
