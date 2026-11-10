<script lang="ts">
    import type {HTMLInputAttributes} from 'svelte/elements'
    let {
        label,
        value = $bindable(''),
        ...rest
    }: Omit<HTMLInputAttributes, 'value'> & {
        label: string
        value?: string
    } = $props()
</script>

<label class="form__field"
    ><span>{label}</span><input class="control" bind:value {...rest} /></label
>
