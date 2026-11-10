<script lang="ts">
    import type {HTMLButtonAttributes} from 'svelte/elements'
    import type {Snippet} from 'svelte'
    let {
        variant = 'ghost',
        class: className = '',
        children,
        type = 'button',
        ...rest
    }: HTMLButtonAttributes & {
        variant?: 'ghost' | 'primary' | 'danger'
        children?: Snippet
    } = $props()
</script>

<button {type} class={`btn btn--${variant} ${className}`} {...rest}
    >{@render children?.()}</button
>
