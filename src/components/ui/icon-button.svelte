<script lang="ts">
    import type {HTMLButtonAttributes} from 'svelte/elements'
    import type {IconName} from '../../app/icons'
    import Button from './button.svelte'
    import Icon from './icon.svelte'
    let {
        label,
        icon,
        iconClass = 'settings__action-icon',
        ...rest
    }: HTMLButtonAttributes & {
        'aria-description'?: string
        label: string
        icon: IconName | 'drag'
        iconClass?: string
        variant?: 'ghost' | 'primary' | 'danger'
    } = $props()
</script>

<Button aria-label={label} title={label} {...rest}
    ><Icon name={icon} class={iconClass} /></Button
>
