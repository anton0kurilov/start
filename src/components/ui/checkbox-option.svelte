<script lang="ts">
    let {
        label,
        checked,
        onchange,
        name,
    }: {
        label: string
        checked: boolean
        onchange: (checked: boolean) => void
        name: string
    } = $props()
</script>

<label class="settings__option"
    ><input
        type="checkbox"
        {name}
        {checked}
        onchange={(event) => onchange(event.currentTarget.checked)}
    /><span class="settings__option-copy"
        ><span class="settings__option-title">{label}</span></span
    ></label
>
