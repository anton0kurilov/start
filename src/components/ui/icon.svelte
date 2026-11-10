<script lang="ts">
    import {icons, type IconName} from '../../app/icons'
    let {
        name,
        class: className = '',
    }: {name: IconName | 'drag'; class?: string} = $props()
</script>

<svg
    class={className}
    viewBox={name === 'drag' ? '0 0 24 24' : icons[name].viewBox}
    aria-hidden="true"
    focusable="false"
>
    {#if name === 'drag'}
        {#each [5, 12, 19] as cy}<circle cx="9" {cy} r="1.5" /><circle
                cx="15"
                {cy}
                r="1.5"
            />{/each}
    {:else}<path d={icons[name].path} />{/if}
</svg>
