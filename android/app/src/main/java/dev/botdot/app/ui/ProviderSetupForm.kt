package dev.botdot.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Api
import dev.botdot.app.data.ClaudeStatus
import dev.botdot.app.data.ProviderModel
import dev.botdot.app.data.ProviderModelCatalog
import dev.botdot.app.data.SetupInfo
import dev.botdot.app.data.tr
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private enum class ModelRole { Main, Helper }

@Composable
internal fun ProviderSetupForm(
    api: Api,
    setup: SetupInfo,
    hasCatalog: Boolean,
    onCancel: () -> Unit,
    onSaved: (ClaudeStatus?) -> Unit,
) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val presets = setup.providers
    val saved = setup.claude.provider
    var preset by remember { mutableStateOf(presets.firstOrNull { it.id == saved?.preset } ?: presets.first()) }
    var key by remember { mutableStateOf("") }
    var address by remember { mutableStateOf(saved?.url.orEmpty()) }
    var catalog by remember { mutableStateOf<ProviderModelCatalog?>(null) }
    var main by remember { mutableStateOf("") }
    var helper by remember { mutableStateOf("") }
    var open by remember { mutableStateOf<ModelRole?>(null) }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    fun reset() {
        catalog = null
        open = null
        error = ""
    }
    val busy = loading || saving
    val models = catalog?.models.orEmpty()
    val same = tr("Same as main model")
    val url = address.trim().takeIf { preset.askUrl }
    val savedKey = saved?.key?.takeIf {
        hasCatalog && saved.preset == preset.id && (!preset.askUrl || url?.trimEnd('/') == saved.url)
    }
    val reuseKey = key.isBlank() && savedKey != null
    val keyReady = preset.keyless || key.isNotBlank() || reuseKey
    val addressReady = !preset.askUrl || !url.isNullOrBlank()

    BackHandler(enabled = open != null && !saving) { open = null }
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Choice(tr("Provider"), preset.id, presets.map { it.id to if (it.custom) tr("Other") else it.name }) { id ->
            if (!busy && id != preset.id) {
                preset = presets.first { it.id == id }
                key = ""
                address = saved?.takeIf { it.preset == id }?.url.orEmpty()
                reset()
            }
        }
        if (preset.askUrl) Field(address, { address = it; reset() }, enabled = !busy, label = { Text(tr("Server address")) },
            placeholder = { Text(preset.url.ifBlank { "https://…" }) }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
        if (!preset.keyless) Field(key, { key = it; reset() }, enabled = !busy, label = { Text(tr("API key")) },
            placeholder = { if (savedKey != null) Text(tr("Saved key {key}", "key" to savedKey)) },
            singleLine = true, visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
        if (models.isNotEmpty()) {
            Rule()
            val mainLabel = models.firstOrNull { it.id == main }?.label ?: tr("Choose a model")
            val helperLabel = models.firstOrNull { it.id == helper }?.label ?: same
            TextButton(enabled = !busy, onClick = { open = if (open == ModelRole.Main) null else ModelRole.Main }) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(tr("Main model"), color = p.muted, style = MaterialTheme.typography.bodySmall)
                        Text(mainLabel, color = p.text)
                    }
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = p.muted)
                }
            }
            if (open == ModelRole.Main) ModelOptions(models, main) { main = it; open = null }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(tr("Helper model"), color = p.muted, style = MaterialTheme.typography.bodySmall)
                    Text(helperLabel, color = p.text)
                }
                TextButton(enabled = !busy, onClick = { open = if (open == ModelRole.Helper) null else ModelRole.Helper }) {
                    Text(tr("Change helper model"), color = p.text)
                }
            }
            if (open == ModelRole.Helper) ModelOptions(listOf(ProviderModel("", same)) + models, helper) { helper = it; open = null }
        }
        if (error.isNotEmpty()) Text(error, color = p.muted)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s12, Alignment.End)) {
            TextButton(enabled = !saving, onClick = onCancel) { Text(tr("Cancel"), color = p.text) }
            Button(
                enabled = !busy && keyReady && addressReady && (models.isEmpty() || main.isNotEmpty()),
                colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText),
                onClick = {
                    error = ""
                    val chosen = preset
                    val enteredKey = key
                    if (models.isEmpty()) {
                        loading = true
                        scope.launch {
                            try {
                                val result = if (hasCatalog) api.claudeProviderModels(chosen.id, enteredKey, url, reuseKey) else {
                                    val previous = saved?.takeIf { it.preset == chosen.id && (it.url == null || it.url == url?.trimEnd('/')) }
                                    val known = listOfNotNull(previous?.big, previous?.small, chosen.big, chosen.small).filter { it.isNotBlank() }.distinct()
                                    ProviderModelCatalog(known.map { ProviderModel(it, it) }, previous?.big ?: chosen.big, previous?.small ?: chosen.small)
                                }
                                catalog = result
                                main = result.main
                                helper = result.helper
                                if (result.models.isEmpty()) error = tr("No models available from this provider.")
                                else {
                                    if (result.limited) error = tr("Model list unavailable. Showing known models.")
                                    if (main.isEmpty()) open = ModelRole.Main
                                }
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                error = e.message ?: tr("Couldn't load")
                            } finally {
                                loading = false
                            }
                        }
                    } else {
                        saving = true
                        open = null
                        scope.launch {
                            try {
                                onSaved(api.claudeSaveProvider(chosen.id, enteredKey, url, main, helper.ifEmpty { main }, reuseKey))
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                error = e.message ?: tr("Couldn't change it")
                            } finally {
                                saving = false
                            }
                        }
                    }
                },
            ) {
                Text(when {
                    loading -> tr("Loading models…")
                    saving -> tr("Checking…")
                    models.isNotEmpty() -> if (preset.custom) tr("Use this provider") else tr("Use {name}", "name" to preset.name)
                    else -> tr("Load models")
                })
            }
        }
    }
}

private val modelWordBoundary = Regex("""[\s._:/-]+""")

@Composable
internal fun ModelOptions(models: List<ProviderModel>, selected: String, onSelect: (String) -> Unit) {
    val p = LocalPaper.current
    var query by remember { mutableStateOf("") }
    val visible = remember(models, query) {
        val words = query.lowercase().split(modelWordBoundary).filter { it.isNotEmpty() }
        models.filter { model ->
            val text = "${model.label} ${model.id}".lowercase()
            words.all { it in text }
        }
    }
    Field(query, { query = it }, label = { Text(tr("Search models")) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { visible.singleOrNull()?.let { onSelect(it.id) } }))
    if (visible.isEmpty()) Text(tr("No models match your search."), color = p.muted)
    else LazyColumn(Modifier.heightIn(max = 224.dp)) {
        items(visible, key = { it.id }) { model ->
            val checked = model.id == selected
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .selectable(checked, role = Role.RadioButton, onClick = { onSelect(model.id) })
                    .padding(horizontal = Space.s12, vertical = Space.s8),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.s8),
            ) {
                Text(model.label, color = p.text, modifier = Modifier.weight(1f))
                if (checked) Icon(Icons.Filled.Check, contentDescription = null, tint = p.text)
            }
        }
    }
}
