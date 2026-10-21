import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text } from "react-native";
import { C } from "@/theme/tokens";

type PostMenuProps = {
  visible: boolean;
  isMine: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Someone else's post (task 059): report it, or block its author. */
  onReport?: () => void;
  onBlock?: () => void;
  authorName?: string;
};

/*
 * iOS drops a new Modal / Alert if it is opened while this
 * modal is still animating out. A short delay avoids that.
 */
const MODAL_CLOSE_DELAY = 300;

export function PostMenu({
  visible,
  isMine,
  onClose,
  onEdit,
  onDelete,
  onReport,
  onBlock,
  authorName,
}: PostMenuProps) {
  const later = (fn?: () => void) => () => {
    onClose();
    if (fn) setTimeout(fn, MODAL_CLOSE_DELAY);
  };

  const handleEdit = () => {
    onClose();
    setTimeout(onEdit, MODAL_CLOSE_DELAY);
  };

  const handleDelete = () => {
    onClose();
    setTimeout(onDelete, MODAL_CLOSE_DELAY);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        {/* Inner Pressable stops taps on the menu from closing it */}
        <Pressable style={styles.menu} onPress={() => {}}>
          {isMine ? (
            <>
              {/* EDIT */}
              <Pressable style={styles.item} onPress={handleEdit}>
                <Ionicons name="create-outline" size={21} color={C.ink} />

                <Text style={styles.itemText}>Edit post</Text>
              </Pressable>

              {/* DELETE */}
              <Pressable style={styles.item} onPress={handleDelete}>
                <Ionicons name="trash-outline" size={21} color="#D9364F" />

                <Text style={[styles.itemText, styles.deleteText]}>
                  Delete post
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              {onReport ? (
                <Pressable style={styles.item} onPress={later(onReport)} accessibilityRole="button" accessibilityLabel="Report post">
                  <Ionicons name="flag-outline" size={21} color={C.ink} />
                  <Text style={styles.itemText}>Report post</Text>
                </Pressable>
              ) : null}
              {onBlock ? (
                <Pressable style={styles.item} onPress={later(onBlock)} accessibilityRole="button" accessibilityLabel={`Block ${authorName || "this person"}`}>
                  <Ionicons name="ban-outline" size={21} color="#D9364F" />
                  <Text style={[styles.itemText, styles.deleteText]}>Block {authorName || "this person"}</Text>
                </Pressable>
              ) : null}
            </>
          )}

          {/* CANCEL */}
          <Pressable
            style={[styles.cancel, isMine === false && !onReport && !onBlock && styles.cancelOnly]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
  },

  menu: {
    width: "82%",
    maxWidth: 360,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    overflow: "hidden",
    paddingVertical: 8,
  },

  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },

  itemText: {
    marginLeft: 14,
    fontSize: 16,
    fontWeight: "600",
    color: C.ink,
  },

  deleteText: {
    color: "#D9364F",
  },

  cancel: {
    borderTopWidth: 1,
    borderTopColor: "#EEEEF2",
    marginTop: 4,
    paddingVertical: 16,
    alignItems: "center",
  },

  cancelOnly: {
    borderTopWidth: 0,
    marginTop: 0,
  },

  cancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: C.grey5,
  },
});
