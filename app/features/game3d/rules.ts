// The rules table this build's 3D fight runs on: fight.gd rules_id() (app/game3d/tests/judge_test.gd pins the
// same string, and a jest test checks the two agree). Sent with /v1/duel/start (fight3d_rules) so the server
// sets the fight up, and later judges it, on this table. The server keeps every table in testers' hands:
// builds 19 to 21 send nothing and stay on "f3d-1-21d2cde61ab2"; build 22 added SHOOT and RAIN, so its table
// and id are new. Deploy the server before an app whose id it does not know (docs/game3d/XP.md).
export const FIGHT3D_RULES = "f3d-2-e872f23a43a5";

// build 28: the five-button panel (Wale's five on screen; WHIRL is the combo's finisher, SPLIT a held ATTACK,
// RALLY comes by itself below half health) is its own table, fight.gd rules_id(3) (tests/five_button_test.gd pins
// it). The app lists every table it can fight on, best first (fight3d_rules_ok); the server picks the first it
// offers (table 3 only while its five_button flag is on), and an old server reads fight3d_rules alone. So this
// build plays the eight-button panel on table 2 until the server turns five_button on, then the five-button one.
// Godot plays the panel of the table the setup names (config "rules", fightFromStart).
export const FIGHT3D_RULES_FIVE = "f3d-3-dd591cb09b67";
export const FIGHT3D_RULES_OK: readonly string[] = [FIGHT3D_RULES_FIVE, FIGHT3D_RULES];
