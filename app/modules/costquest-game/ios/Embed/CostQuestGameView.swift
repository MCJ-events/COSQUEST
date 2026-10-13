import ExpoModulesCore
import UIKit

/// Where the game draws: the one hosting controller GameHost keeps, attached
/// to whichever view controller holds this view. The controller outlives the
/// view, so a remount (or the page sliding away and back) finds the world
/// exactly as it was left.
public final class CostQuestGameView: ExpoView {
  private weak var attachedTo: UIViewController?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { attach() } else { detach() }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    GameHost.shared.hostingController().view.frame = bounds
  }

  private func attach() {
    let controller = GameHost.shared.hostingController()
    guard let parent = nearestViewController() else { return }
    if controller.parent !== parent {
      if controller.parent != nil {
        controller.willMove(toParent: nil)
        controller.view.removeFromSuperview()
        controller.removeFromParent()
      }
      parent.addChild(controller)
      addSubview(controller.view)
      controller.view.frame = bounds
      controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      controller.didMove(toParent: parent)
      attachedTo = parent
    } else if controller.view.superview !== self {
      addSubview(controller.view)
      controller.view.frame = bounds
    }
  }

  private func detach() {
    let controller = GameHost.shared.hostingController()
    // Only if it is still ours: a newer view may have taken it already.
    guard controller.view.superview === self else { return }
    controller.willMove(toParent: nil)
    controller.view.removeFromSuperview()
    controller.removeFromParent()
    attachedTo = nil
  }

  private func nearestViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let current = responder {
      if let vc = current as? UIViewController { return vc }
      responder = current.next
    }
    return window?.rootViewController
  }
}
