import Foundation
import BotdotShared

/// [text] in the account's language, its {placeholders} filled from [vars]: the shared layer's tr (ADR 108), so the
/// iPhone draws the same words as Android from the same dictionary the server hands out, in any language it offers (ADR 280).
func tr(_ text: String, _ vars: [String: String] = [:]) -> String {
    BotdotShared.tr(text: text, vars: pairs(vars))
}

/// A count: [one] for one and [other] otherwise in English; the other languages' forms are keyed by [other], picked by
/// the shared layer's CLDR plural rules (I18n.form, ADR 280). {n} is [n].
func trn(_ n: Int, _ one: String, _ other: String, _ vars: [String: String] = [:]) -> String {
    BotdotShared.trn(n: Int32(n), one: one, other: other, vars: pairs(vars))
}

private func pairs(_ vars: [String: String]) -> KotlinArray<KotlinPair<NSString, AnyObject>> {
    let list = Array(vars)
    return KotlinArray(size: Int32(list.count)) { i in
        KotlinPair(first: list[Int(truncating: i)].key as NSString, second: list[Int(truncating: i)].value as NSString)
    }
}
