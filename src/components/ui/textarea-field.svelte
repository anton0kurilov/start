<script lang="ts">
    import type {HTMLTextareaAttributes} from 'svelte/elements'
    let {
        label,
        value = $bindable(''),
        class: className = '',
        ...rest
    }: Omit<HTMLTextareaAttributes, 'value'> & {
        label: string
        value?: string
    } = $props()
</script>

<label class="form__field"
    ><span>{label}</span><textarea
        class={`control ${className}`}
        bind:value
        {...rest}></textarea></label
>
